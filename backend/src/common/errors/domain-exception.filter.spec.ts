import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { DomainExceptionFilter } from './domain-exception.filter';
import { ComplianceBlockedError } from './domain-error';
import { ErrorCode } from './error-code.enum';

/** Build a mock ArgumentsHost capturing the response status + JSON body. */
function mockHost() {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'POST', url: '/api/test' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('DomainExceptionFilter', () => {
  const filter = new DomainExceptionFilter();

  it('maps a DomainError to the standard envelope with its http status', () => {
    const { host, status, json } = mockHost();

    filter.catch(new ComplianceBlockedError({ message: 'blocked by compliance', details: { riskTags: ['policy'] } }), host);

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: ErrorCode.OutreachBlockedByCompliance,
        message: 'blocked by compliance',
        retryable: false,
        details: { riskTags: ['policy'] },
      },
    });
  });

  it('maps a framework HttpException to the envelope', () => {
    const { host, status, json } = mockHost();

    filter.catch(new BadRequestException('bad input'), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: ErrorCode.ValidationFailed, retryable: false }),
      }),
    );
  });

  it('maps an unknown throwable to a 500 INTERNAL envelope', () => {
    const { host, status, json } = mockHost();

    filter.catch(new Error('boom'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: { code: ErrorCode.Internal, message: 'Internal server error', retryable: false, details: {} },
    });
  });
});
